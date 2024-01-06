import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep, ManualApprovalStep, CodeBuildStep } from 'aws-cdk-lib/pipelines';
import * as iam from "aws-cdk-lib/aws-iam";
import { CdkpipelinesStage } from "./cdkpipelines-stage"

/**
 * The stack that defines the application pipeline
 */
export class CdkpipelinesStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']
    const connectionArn = config['connection_arn']

    const input = CodePipelineSource.connection(
      `${config['githubOrg']}/${config['githubRepo']}`,
      config['githubBranch'],
      { connectionArn })

    const codeBuildStep = new CodeBuildStep('Synth', {
      input,
      env: {
        'CDK_DEVELOPMENT_ACCOUNT': accounts['CICD_ACCOUNT_ID'],
        'CDK_PRODUCTION_ACCOUNT': accounts['PRD_ACCOUNT_ID'],
        'REPOSITORY_NAME': config['githubRepo'],
        'BRANCH': config['githubBranch'],
      },
      commands: [
        'npm ci',
        'npm run build',
        'npx cdk synth -c TargetStack=CdkpipelinesStack'
      ],
      buildEnvironment: {
        privileged: true // required for the lambda-nodejs module
      },
      rolePolicyStatements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:DescribeAvailabilityZones'],
          resources: ['*']
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${accounts['PRD_ACCOUNT_ID']}:role/cdk-hnb659fds-lookup-role-${accounts['PRD_ACCOUNT_ID']}-${config['region']}`]
        }),
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [
            `arn:aws:iam::${accounts['PRD_ACCOUNT_ID']}:role/admin-role-from-cicd-account`
          ],
        }),
      ]
    })


    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'RDSSchemaMigrationDemo',
      crossAccountKeys: true,
      selfMutation: false,
      synth: codeBuildStep
    });


    // development stage
    const dev = new CdkpipelinesStage(
      this,
      'dev',
      false,
      accounts['CICD_ACCOUNT_ID'], {
      env: {
        account: accounts['CICD_ACCOUNT_ID'],
        region: this.region
      }
    });

    pipeline.addStage(dev, {
      post: [this.generateDatabaseSchemaMigration(dev, this.region, this.account)]
    });

    // production stage
    const prod = new CdkpipelinesStage(
      this,
      'prod',
      true,
      accounts['CICD_ACCOUNT_ID'], {
      env: {
        account: accounts['PRD_ACCOUNT_ID'],
        region: this.region
      }
    });

    pipeline.addStage(prod, {
      pre: [
        new ManualApprovalStep('ManualApproval', {
          comment: "Approve deployment to production"
        })
      ],
      post: [this.generateDatabaseSchemaMigration(prod, this.region, accounts['PRD_ACCOUNT_ID'])]
    });

    pipeline.buildPipeline();
    let cfnRole = (codeBuildStep.project.role as iam.Role).node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('RoleName', 'RDSSchemaMigrationPipelineSynthRole');
  }

  private generateDatabaseSchemaMigration(stage: CdkpipelinesStage, region: string, account: string) {
    const buildCommands: string[] = [];

    const rolePolicyStatements = [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:${region}:${account}:function:${stage.lambdaFunctionName}`],
      })
    ]

    if (stage.stageName === 'prod') {
      // assume cross account role if production environment
      buildCommands.push(
        `aws sts assume-role --role-arn arn:aws:iam::${account}:role/${stage.crossAccountLambdaInvokeRoleName} --role-session-name "CrossAccountSession" > credentials.json`,
        'export AWS_ACCESS_KEY_ID=$(cat credentials.json | jq -r ".Credentials.AccessKeyId")',
        'export AWS_SECRET_ACCESS_KEY=$(cat credentials.json | jq -r ".Credentials.SecretAccessKey")',
        'export AWS_SESSION_TOKEN=$(cat credentials.json | jq -r ".Credentials.SessionToken")'
      )

      // allow to assume role if production environment
      rolePolicyStatements.push(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${account}:role/${stage.crossAccountLambdaInvokeRoleName}`]
        })
      )
    }

    // invoke lambda in all environments
    buildCommands.push(
      'aws lambda invoke --function-name $DB_MIGRATE_FUNCTION_NAME out.json --log-type Tail --query LogResult --output text |  base64 -d',
      'lambdaStatus=$(cat out.json | jq ".StatusCode")',
      'if [ $lambdaStatus = 500 ]; then exit 1; else exit 0; fi'
    )

    return new CodeBuildStep(`RDSSchemaUpdate-${stage.stageName}`, {
      env: {
        DB_MIGRATE_FUNCTION_NAME: stage.lambdaFunctionName,
      },
      commands: buildCommands,
      rolePolicyStatements: rolePolicyStatements
    })
  }

}
