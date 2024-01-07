import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface RdsDbSchemaMigrationsLambdaProps {
  readonly dbCredentialsSecretName: cdk.CfnOutput,
  readonly dbCredentialsSecretArn: cdk.CfnOutput,
  readonly vpc: ec2.Vpc,
  readonly securityGroup: ec2.SecurityGroup,
  readonly defaultDBName: string,
  readonly crossAccount: boolean,
  readonly stageName: string,
  readonly devAccountId?: string
}

/**
 * A stack for our simple Lambda-powered web service
 */
export class RdsDbSchemaMigrationsLambda extends Construct {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string = 'CrossAccountLambdaInvokeRole';

  constructor(scope: Construct, id: string, props: RdsDbSchemaMigrationsLambdaProps) {
    super(scope, id);

    this.lambdaFunctionName = `RDSSchemaMigrationFunction-${props.stageName}`;

    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'LambdaBasicExecution', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'LambdaVPCExecution', 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      inlinePolicies: {
        secretsManagerPermissions: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'kms:Decrypt',
              ],
              resources: [
                props.dbCredentialsSecretArn.value
              ]
            }),
          ]
        })
      }
    })

    // The Lambda function that contains the functionality
    const func = new NodejsFunction(this, 'Lambda', {
      functionName: this.lambdaFunctionName,
      handler: 'handler',
      entry: path.resolve(__dirname, 'lambda/handler.ts'),
      timeout: cdk.Duration.minutes(10),
      bundling: {
        externalModules: [
          'aws-sdk'
        ],
        nodeModules: [
          'knex',
          'pg'
        ],
        commandHooks: {
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cp -r ${inputDir}/migrations ${outputDir}`, `find ${outputDir}/migrations -type f ! -name '*.js' -delete`];
          },
          beforeBundling() {
            return [];
          },
          beforeInstall() {
            return [];
          }
        }
      },
      depsLockFilePath: path.resolve(__dirname, 'lambda', 'package-lock.json'),
      projectRoot: path.resolve(__dirname, 'lambda'),
      environment: {
        RDS_DB_PASS_SECRET_ID: props.dbCredentialsSecretName.value,
        RDS_DB_NAME: props.defaultDBName
      },
      vpc: props.vpc,
      role: lambdaRole,
      securityGroups: [props.securityGroup]
    })

    if (props.crossAccount) {
      new iam.Role(this, 'CrossAccountLambdaInvokeRole', {
        roleName: this.crossAccountLambdaInvokeRoleName,
        assumedBy: new iam.AccountPrincipal(props.devAccountId),
        inlinePolicies: {
          invokeLambdaPermissions: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['iam:PassRole'],
                resources: ['*']
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['lambda:InvokeFunction'],
                resources: [func.functionArn],
              }),
            ]
          })
        }
      })
    }
  }
}