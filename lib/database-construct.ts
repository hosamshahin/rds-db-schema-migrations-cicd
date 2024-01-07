import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface DatabaseProps {
  readonly stageName: string,
}

export class Database extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly secretName: cdk.CfnOutput;
  public readonly secretArn: cdk.CfnOutput;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly defaultDBName: string = "postgres";
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string = 'CrossAccountLambdaInvokeRole';

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']

    this.vpc = new ec2.Vpc(this, 'RdsVpc');

    this.securityGroup = new ec2.SecurityGroup(this, 'LambdaPostgresConnectionSG', {
      vpc: this.vpc,
      description: "Lambda security group to connect to Postgres db.",
      allowAllOutbound: true
    })

    this.securityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(5432), 'Allow Postgres Communication')

    const secret = new sm.Secret(this, 'Secret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"',
      },
    });

    new rds.DatabaseInstance(this, "PostgresInstance", {
      engine: rds.DatabaseInstanceEngine.POSTGRES,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: {
        username: secret.secretValueFromJson('username').toString(),
        password: secret.secretValueFromJson('password')
      },
      vpc: this.vpc,
      publiclyAccessible: props.stageName === 'dev' ? true : false,
      securityGroups: [this.securityGroup],
      databaseName: this.defaultDBName
    });

    // Outputs
    this.secretName = new cdk.CfnOutput(this, 'secretName', {
      value: secret.secretName
    });

    this.secretArn = new cdk.CfnOutput(this, 'secretArn', {
      value: secret.secretArn
    });

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
                this.secretArn.value
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
        RDS_DB_PASS_SECRET_ID: this.secretName.value,
        RDS_DB_NAME: this.defaultDBName
      },
      vpc: this.vpc,
      role: lambdaRole,
      securityGroups: [this.securityGroup]
    })

    new iam.Role(this, 'CrossAccountLambdaInvokeRole', {
      roleName: this.crossAccountLambdaInvokeRoleName,
      assumedBy: new iam.AccountPrincipal(accounts['CICD_ACCOUNT_ID']),
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


