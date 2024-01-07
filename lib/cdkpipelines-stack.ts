import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ManualApprovalStep, CodeBuildStep } from 'aws-cdk-lib/pipelines';
import * as iam from "aws-cdk-lib/aws-iam";
import { AppStage } from "./app-stack"

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

    const synthStep = new CodeBuildStep('Synth', {
      input,
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
          resources: [
            `arn:aws:iam::${accounts['DEV_ACCOUNT_ID']}:role/cdk-hnb659fds-lookup-role-${accounts['DEV_ACCOUNT_ID']}-${config['region']}`,
            `arn:aws:iam::${accounts['PRD_ACCOUNT_ID']}:role/cdk-hnb659fds-lookup-role-${accounts['PRD_ACCOUNT_ID']}-${config['region']}`
          ]
        }),
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [
            `arn:aws:iam::${accounts['DEV_ACCOUNT_ID']}:role/admin-role-from-cicd-account`,
            `arn:aws:iam::${accounts['PRD_ACCOUNT_ID']}:role/admin-role-from-cicd-account`
          ],
        }),
      ]
    })

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'RDSSchemaMigrationDemo',
      crossAccountKeys: true,
      synth: synthStep
    });

    const devStage = new AppStage(this, 'dev', {
      env: {
        account: accounts['DEV_ACCOUNT_ID'],
        region: this.region
      }
    });

    pipeline.addStage(devStage, {
      post: [this.generateDatabaseSchemaMigration(accounts['DEV_ACCOUNT_ID'])]
    });


    const prdStage = new AppStage(this, 'prd', {
      env: {
        account: accounts['PRD_ACCOUNT_ID'],
        region: this.region
      }
    });


    pipeline.addStage(prdStage, {
      pre: [
        new ManualApprovalStep('ManualApproval', {
          comment: "Approve deployment to production"
        })
      ],
      post: [this.generateDatabaseSchemaMigration(accounts['PRD_ACCOUNT_ID'])]
    });

    pipeline.buildPipeline();
    let cfnRole = (synthStep.project.role as iam.Role).node.defaultChild as iam.CfnRole;
    cfnRole.addPropertyOverride('RoleName', config['resourceAttr']['schemaMigrationCodeBuildStepRole']);
  }

  private generateDatabaseSchemaMigration(account: string) {

    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']
    const envName = account == accounts['DEV_ACCOUNT_ID'] ? 'dev' : 'prod'
    const role = config['resourceAttr']['crossAccountLambdaRole']
    const FunctionName = `${config['resourceAttr']['schemaMigrationFnName']}-${envName}`

    return new CodeBuildStep(`RDSSchemaUpdate-${envName}`, {
      env: {
        DB_MIGRATE_FUNCTION_NAME: FunctionName,
      },
      commands: [
        `aws sts assume-role --role-arn arn:aws:iam::${account}:role/${role} --role-session-name "CrossAccountSession" > credentials.json`,
        'export AWS_ACCESS_KEY_ID=$(cat credentials.json | jq -r ".Credentials.AccessKeyId")',
        'export AWS_SECRET_ACCESS_KEY=$(cat credentials.json | jq -r ".Credentials.SecretAccessKey")',
        'export AWS_SESSION_TOKEN=$(cat credentials.json | jq -r ".Credentials.SessionToken")',
        'aws lambda invoke --function-name $DB_MIGRATE_FUNCTION_NAME out.json --log-type Tail --query LogResult --output text |  base64 -d',
        'lambdaStatus=$(cat out.json | jq ".StatusCode")',
        'if [ $lambdaStatus = 500 ]; then exit 1; else exit 0; fi'
      ],
      rolePolicyStatements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${account}:function:${FunctionName}`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${account}:role/${role}`]
        })
      ]
    })
  }
}